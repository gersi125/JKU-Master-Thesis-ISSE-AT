using System;
using System.Security.Cryptography;
public class Person
{
    private string Name{get; set;}

    private int Age{get; set;}

    private string Address{get; set;}

    private string PhoneNumber{get; set;}





    

    
    public Person( int age, string name, string address, string phoneNumber)
    {

        if (age < 0)
        {
            throw new ArgumentException("Age cannot be negative.");
        }


    }
     
}



