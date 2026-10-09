using System;
using System.Security.Cryptography;

public class NewBaseType
{private string PhoneNumber { get; set; }
    private string Address { get; set; }
    private string Name { get; set; }
    private int Age { get; set; }
    
    private string Email { get; set; }

}

public class Teacher : NewBaseType
{
    public Teacher(int age,string address, string email, string name,string phoneNumber)
    {

        if (age < 0)
        {   

            throw new ArgumentException("Age cannot be negative.");

        } else
        {
            Age = age;
            
        }
        
        Age = 12222;
        This.Address = address;


        

    }
     
}



