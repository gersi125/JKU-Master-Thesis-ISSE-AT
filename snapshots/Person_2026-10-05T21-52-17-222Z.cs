using System;
using System.Security.Cryptography;

public class NewBaseType
{
    private string Address { get; set; }
    private string Name { get; set; }
    private string PhoneNumber { get; set; } 
    public int Age { get; set; }
    private string Email { get; set; }
}

public class Teacher : NewBaseType
{
    public Teacher(string name,  int height, string phoneNumber,int age)
    {
        Name = name;
        int Height = height;
        int Age = age;

        if (Age < 0)
        {   

            throw new ArgumentException("Age cannot be negative.");

        } else
        {
        System.Console.WriteLine($"Teacher Name: {Name}, Height: {Height}, Phone Number: {phoneNumber}, Age: {Age}");
          Age++;  
        }
        
        
       
    }
     
}



