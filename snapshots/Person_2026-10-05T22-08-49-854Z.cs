using System;
using System.Security.Cryptography;

public class NewBaseType
{
    private string Address { get; set; }
    private string Name { get; set; }
    private string PhoneNumber { get; set; } 
    private int Age { get; set; }

    public double Height { get; set; }
}

public class Teacher : NewBaseType
{
    public Teacher(string name,  int height,int age, string phoneNumber)
    {



        
       
    }
    

    public int GetAge()
    {   
        System.Console.WriteLine($"Teacher Age is: {Age}");
        return Age;
    }
}



